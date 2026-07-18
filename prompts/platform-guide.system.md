# Platform-Specific Command Reference

## Windows PowerShell Commands

### File Operations
- List files: Get-ChildItem (or dir)
- Create directory: New-Item -ItemType Directory -Path "name"
- Copy file: Copy-Item "source" "destination"
- Move file: Move-Item "source" "destination"
- Delete file: Remove-Item "path"
- Read file: Get-Content "path"
- Write file: Set-Content "path" "content"
- Append to file: Add-Content "path" "content"

### Text Search
- Search in files: Get-ChildItem -Recurse | Select-String -Pattern "text"
- Search specific extension: Get-ChildItem -Recurse -Include "*.ts" | Select-String -Pattern "text"
- Find files by name: Get-ChildItem -Recurse -Filter "*.ts"

### Process Management
- List processes: Get-Process
- Kill process: Stop-Process -Id <pid>
- Run in background: Start-Process -NoNewWindow

### Git Commands (same cross-platform)
- Status: git status
- Add: git add .
- Commit: git commit -m "message"
- Push: git push
- Pull: git pull
- Branch: git branch
- Checkout: git checkout <branch>
- Merge: git merge <branch>
- Log: git log --oneline
- Diff: git diff

## Linux Commands

### File Operations
- List files: ls -la
- Create directory: mkdir -p path
- Copy file: cp source dest
- Move file: mv source dest
- Delete file: rm file
- Delete directory: rm -rf dir
- Read file: cat file
- Write file: echo "content" > file
- Append: echo "content" >> file

### Text Search
- Search in files: grep -r "text" .
- Search specific extension: grep -r "text" --include="*.ts" .
- Find files: find . -name "*.ts"
- Find by content: find . -exec grep -l "text" {} \;

### Process Management
- List processes: ps aux
- Kill process: kill <pid>
- Run in background: command &

## Common Patterns

### Reading a file
Windows: Get-Content "path/to/file.ts"
Linux: cat path/to/file.ts

### Searching for text
Windows: Get-ChildItem -Recurse -Include "*.ts" | Select-String -Pattern "searchTerm"
Linux: grep -r "searchTerm" --include="*.ts" .

### Running a command and capturing output
Windows: $result = Get-ChildItem -Recurse
Linux: result=$(find . -name "*.ts")

### Environment Variables
Windows: $env:VARIABLE_NAME
Linux: $VARIABLE_NAME or echo $VARIABLE_NAME

## Error Recovery

### When command not found
- Check if command exists: Get-Command <command> (Windows) / which <command> (Linux)
- Install if needed or use alternative

### When permission denied
- Check file permissions: icacls file (Windows) / ls -la file (Linux)
- Run as administrator if needed

### When file not found
- Verify path: Test-Path "path" (Windows) / test -f path (Linux)
- Search for file: Get-ChildItem -Recurse -Filter "filename" (Windows) / find . -name "filename" (Linux)
